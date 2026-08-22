; case strops-006-concat
; expect exit=0 stdout="\n\t\n"
.func main arity=0 locals=0
  PUSH_STR "\n"
  PUSH_STR "\t"
  CONCAT
  PRINT
  RET
.end
