; case compare-028-ltint
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_INT -1
  PUSH_INT 1
  LT
  PRINT
  RET
.end
