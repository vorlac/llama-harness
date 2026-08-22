; case strops-024-substr
; expect exit=0 stdout="cd\n"
.func main arity=0 locals=0
  PUSH_STR "abcdef"
  PUSH_INT 2
  PUSH_INT 2
  SUBSTR
  PRINT
  RET
.end
