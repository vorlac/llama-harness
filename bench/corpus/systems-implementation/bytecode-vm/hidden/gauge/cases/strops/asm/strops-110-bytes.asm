; case strops-110-bytes
; expect exit=0 stdout="b\n"
.func main arity=0 locals=0
  PUSH_STR "a\x00b"
  PUSH_INT 2
  PUSH_INT 1
  SUBSTR
  PRINT
  RET
.end
