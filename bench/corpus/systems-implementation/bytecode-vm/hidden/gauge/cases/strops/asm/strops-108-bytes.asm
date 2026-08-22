; case strops-108-bytes
; expect exit=0 stdout="1\n"
.func main arity=0 locals=0
  PUSH_STR "\x00"
  LEN
  PRINT
  RET
.end
