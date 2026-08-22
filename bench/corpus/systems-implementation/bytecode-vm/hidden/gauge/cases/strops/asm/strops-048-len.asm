; case strops-048-len
; expect exit=0 stdout="2\n"
.func main arity=0 locals=0
  PUSH_STR "\n\t"
  LEN
  PRINT
  RET
.end
